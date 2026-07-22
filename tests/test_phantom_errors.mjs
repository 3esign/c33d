import assert from 'assert';

// Define NODE_LIBRARY subset for testing
const NODE_LIBRARY = {
  Sphere: {
    params: [
      { name: 'radius', type: 'number' },
      { name: 'radiusX', type: 'number' },
      { name: 'radiusY', type: 'number' }
    ]
  }
};

// Copy implementation of checkGeometrySanity
function checkGeometrySanity(report, evalError) {
  const issues = [];
  if (evalError) {
    issues.push(`Evaluation error: ${evalError}`);
  }
  if (!report) return { sane: issues.length === 0, issues };

  if (report.meshedLeafCount === 0 && report.leaves.length > 0) {
    issues.push('No leaf node produced meshable geometry — the viewport is empty.');
  }
  for (const err of report.nodeErrors) {
    issues.push(`Node "${err.id}" failed: ${err.error}`);
  }
  for (const leaf of report.leaves) {
    if (!leaf.meshOk) {
      issues.push(`Leaf "${leaf.id}" could not be meshed${leaf.error ? `: ${leaf.error}` : ''}.`);
      continue;
    }
    if (leaf.bbox) {
      const [sx, sy, sz] = leaf.bbox.size;
      if (!isFinite(sx) || !isFinite(sy) || !isFinite(sz)) {
        issues.push(`Leaf "${leaf.id}" has a non-finite bounding box (degenerate geometry).`);
      } else if (sx < 1e-6 && sy < 1e-6 && sz < 1e-6) {
        issues.push(`Leaf "${leaf.id}" has zero size (degenerate geometry).`);
      }
    }
    if (leaf.volume !== undefined && leaf.volume <= 0) {
      issues.push(`Leaf "${leaf.id}" has non-positive volume (${leaf.volume}) — likely inverted or degenerate solid.`);
    }
  }

  const warnings = [];

  // Scattered-parts check: any leaf whose center is far outside the scene bulk
  if (report.scene && report.leaves.length > 1) {
    const diag = Math.sqrt(report.scene.size[0] ** 2 + report.scene.size[1] ** 2 + report.scene.size[2] ** 2);
    const sceneCenter = [
      (report.scene.min[0] + report.scene.max[0]) / 2,
      (report.scene.min[1] + report.scene.max[1]) / 2,
      (report.scene.min[2] + report.scene.max[2]) / 2,
    ];
    for (const leaf of report.leaves) {
      if (!leaf.bbox) continue;
      const d = Math.sqrt(
        (leaf.bbox.center[0] - sceneCenter[0]) ** 2 +
        (leaf.bbox.center[1] - sceneCenter[1]) ** 2 +
        (leaf.bbox.center[2] - sceneCenter[2]) ** 2
      );
      if (diag > 0 && d > diag * 0.75) {
        warnings.push(`Leaf "${leaf.id}" is far from the rest of the model (distance ${d} vs scene diagonal ${diag}) — it may be floating in space unintentionally.`);
      }
    }
  }

  // Coincident duplicates
  {
    const live = report.leaves.filter((l) => l.bbox && l.bbox.size.every((s) => isFinite(s)));
    const diag = report.scene ? Math.sqrt(report.scene.size.reduce((s, v) => s + v * v, 0)) : 0;
    const tol = Math.max(diag * 0.005, 1e-4);
    let flagged = 0;
    for (let i = 0; i < live.length && flagged < 4; i++) {
      for (let j = i + 1; j < live.length && flagged < 4; j++) {
        const a = live[i].bbox, b = live[j].bbox;
        const same = [0, 1, 2].every(k =>
          Math.abs(a.center[k] - b.center[k]) <= tol && Math.abs(a.size[k] - b.size[k]) <= tol);
        if (same) {
          flagged++;
          warnings.push(`Leaves "${live[i].id}" and "${live[j].id}" occupy the exact same space (same center and size) — one is almost certainly a stale duplicate from an earlier attempt. Remove one of them (remove_nodes), do not move it.`);
        }
      }
    }
  }

  return { sane: issues.length === 0, issues, warnings };
}

// Copy implementation of validateAndNormalizeNodeData
function validateAndNormalizeNodeData(id, type, data, _macros) {
  const warnings = [];
  const errors = [];
  const validatedData = {};

  if (!data) return { warnings, errors, validatedData };

  const def = NODE_LIBRARY[type];
  if (!def) {
    return { warnings, errors, validatedData: { ...data } };
  }

  const allowedKeys = new Set([
    'label',
    'formula',
    'operation',
    'color',
    'macroId',
    'parentId',
    'axisFilter',
    'direction',
    'index',
    'tolerance'
  ]);

  const allowedKeysLowerMap = new Map();
  allowedKeys.forEach(k => allowedKeysLowerMap.set(k.toLowerCase(), k));

  const validParams = def.params.map(p => p.name);
  const validParamsLowerMap = new Map();
  validParams.forEach(p => validParamsLowerMap.set(p.toLowerCase(), p));

  for (const [key, value] of Object.entries(data)) {
    const keyLower = key.toLowerCase();
    
    if (allowedKeysLowerMap.has(keyLower)) {
      const correctKey = allowedKeysLowerMap.get(keyLower);
      validatedData[correctKey] = value;
      if (correctKey !== key) {
        warnings.push(`field "${key}" on node "${id}" was auto-corrected to "${correctKey}"`);
      }
      continue;
    }

    const doubleUnderscoreIdx = key.indexOf('__');
    if (doubleUnderscoreIdx > 0) {
      const baseParam = key.slice(0, doubleUnderscoreIdx);
      const suffix = key.slice(doubleUnderscoreIdx);
      if (suffix === '__min' || suffix === '__max' || suffix === '__step') {
        const baseParamLower = baseParam.toLowerCase();
        if (validParamsLowerMap.has(baseParamLower)) {
          const correctBase = validParamsLowerMap.get(baseParamLower);
          validatedData[correctBase + suffix] = value;
          if (correctBase !== baseParam) {
            warnings.push(`parameter override "${key}" on node "${id}" was auto-corrected to "${correctBase + suffix}"`);
          }
        } else {
          errors.push(`unknown parameter override "${key}" on node "${id}" (node type "${type}" has no parameter "${baseParam}")`);
        }
        continue;
      }
    }

    if (validParamsLowerMap.has(keyLower)) {
      const correctKey = validParamsLowerMap.get(keyLower);
      validatedData[correctKey] = value;
      if (correctKey !== key) {
        warnings.push(`parameter "${key}" on node "${id}" was auto-corrected to "${correctKey}"`);
      }
    } else {
      errors.push(`unknown parameter "${key}" on node "${id}" (node type "${type}" does not support "${key}"). Valid parameters: ${validParams.join(', ') || '(none)'}`);
    }
  }

  return { warnings, errors, validatedData };
}

// Copy implementation of aggregateAndRankIssues
function aggregateAndRankIssues(issues) {
  const structural = [];
  const nullGeometry = [];
  const engine = [];
  const containment = [];
  const proportional = [];
  const others = [];

  const propRegex = /At (.*?) (?:increase|decrease) \(.*?x\), "(.*?)" shifts non-proportionally.*\(deviation (\d+)%\)/i;
  const propBySlider = {};

  for (const issue of issues) {
    const lower = issue.toLowerCase();
    const match = issue.match(propRegex);
    if (match) {
      const slider = match[1];
      const part = match[2];
      const dev = parseInt(match[3], 10);
      if (!propBySlider[slider]) {
        propBySlider[slider] = { parts: new Set(), worstPart: part, worstDev: dev };
      }
      propBySlider[slider].parts.add(part);
      if (dev > propBySlider[slider].worstDev) {
        propBySlider[slider].worstDev = dev;
        propBySlider[slider].worstPart = part;
      }
      continue;
    }
    if (lower.includes('shifts non-proportionally') || lower.includes('fragile under scaling')) {
      proportional.push(issue);
      continue;
    }
    if (
      lower.includes('missing required input') ||
      lower.includes('no connection on input') ||
      lower.includes('is not set. expected formula') ||
      lower.includes('deviation: "') ||
      lower.includes('does not exist') ||
      lower.includes('does not output') ||
      lower.includes('target handle') ||
      lower.includes('expression') && lower.includes('not connected')
    ) {
      structural.push(issue);
      continue;
    }
    if (
      lower.includes('could not be meshed') ||
      lower.includes('failed:') ||
      lower.includes('produced no geometry') ||
      lower.includes('degenerate geometry') ||
      lower.includes('non-positive volume')
    ) {
      nullGeometry.push(issue);
      continue;
    }
    if (
      lower.includes('engine fault') ||
      lower.includes('evaluation error') ||
      lower.includes('timed out') ||
      lower.includes('crashed') ||
      lower.includes('kernel failed')
    ) {
      engine.push(issue);
      continue;
    }
    if (
      lower.includes('floating in space') ||
      lower.includes('far from the rest') ||
      lower.includes('exact same space') ||
      lower.includes('stale duplicate') ||
      lower.includes('buried inside') ||
      lower.includes('fully contained')
    ) {
      containment.push(issue);
      continue;
    }
    others.push(issue);
  }

  const proportionalFormatted = [];
  for (const [slider, info] of Object.entries(propBySlider)) {
    proportionalFormatted.push(
      `${info.parts.size} parts shift non-proportionally when "${slider}" moves — positions use absolute Translates; worst: "${info.worstPart}" (${info.worstDev}%)`
    );
  }

  let duplicateCount = 0;
  const filteredContainment = [];
  for (const c of containment) {
    if (c.toLowerCase().includes('occupy the exact same space')) {
      duplicateCount++;
    } else {
      filteredContainment.push(c);
    }
  }
  if (duplicateCount > 0) {
    filteredContainment.push(`${duplicateCount} pairs of leaves occupy the exact same space (stale duplicates). Remove one of them.`);
  }

  const ordered = [
    ...structural,
    ...nullGeometry,
    ...engine,
    ...filteredContainment,
    ...proportionalFormatted,
    ...proportional.filter(p => !p.match(propRegex)),
    ...others
  ];

  if (ordered.length > 5) {
    const capped = ordered.slice(0, 5);
    capped.push(`... and ${ordered.length - 5} more quality issues (see full list in UI).`);
    return capped;
  }
  return ordered;
}

function runTests() {
  console.log('=== Running Phantom Error & Validation Tests ===');

  // Test 1: Healthy intermediate graph (Sphere -> Translate) should yield 0 issues
  console.log('Test 1: checkGeometrySanity healthy intermediate graph');
  const healthyReport = {
    meshedLeafCount: 1,
    leaves: [
      { id: 'Translate', meshOk: true, bbox: { min: [0, 0, 0], max: [1, 1, 1], center: [0.5, 0.5, 0.5], size: [1, 1, 1] }, volume: 1.0 }
    ],
    nodeErrors: [],
    scene: { min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1] }
  };
  const sanityResult1 = checkGeometrySanity(healthyReport, null);
  assert.strictEqual(sanityResult1.sane, true);
  assert.strictEqual(sanityResult1.issues.length, 0);
  console.log('Test 1 passed.');

  // Test 2: Quality issues should be warnings and NOT block sanity
  console.log('Test 2: checkGeometrySanity quality issue separation');
  const qualityIssueReport = {
    meshedLeafCount: 2,
    leaves: [
      { id: 'Leaf1', meshOk: true, bbox: { min: [0, 0, 0], max: [1, 1, 1], center: [0.5, 0.5, 0.5], size: [1, 1, 1] }, volume: 1.0 },
      { id: 'Leaf2', meshOk: true, bbox: { min: [0, 0, 0], max: [1, 1, 1], center: [0.5, 0.5, 0.5], size: [1, 1, 1] }, volume: 1.0 }
    ],
    nodeErrors: [],
    scene: { min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1] }
  };
  const sanityResult2 = checkGeometrySanity(qualityIssueReport, null);
  assert.strictEqual(sanityResult2.sane, true);
  assert.ok(sanityResult2.warnings && sanityResult2.warnings.length > 0);
  assert.ok(sanityResult2.warnings[0].includes('occupy the exact same space'));
  console.log('Test 2 passed.');

  // Test 3: validateAndNormalizeNodeData corrections and errors
  console.log('Test 3: validateAndNormalizeNodeData');
  const result1 = validateAndNormalizeNodeData('node1', 'Sphere', { RadiusX: 5, RadiusY: 10 }, []);
  assert.strictEqual(result1.errors.length, 0);
  assert.strictEqual(result1.warnings.length, 2);
  assert.strictEqual(result1.validatedData.radiusX, 5);
  assert.strictEqual(result1.validatedData.radiusY, 10);

  const result2 = validateAndNormalizeNodeData('node2', 'Sphere', { invalidField: 42 }, []);
  assert.strictEqual(result2.errors.length, 1);
  assert.ok(result2.errors[0].includes('unknown parameter'));
  console.log('Test 3 passed.');

  // Test 4: aggregateAndRankIssues grouping
  console.log('Test 4: aggregateAndRankIssues');
  const rawIssues = [
    'At catSize increase (1.5x), "body" shifts non-proportionally relative to the assembly center (deviation 12%). Derive its position from the driver sliders or use Align.',
    'At catSize increase (1.5x), "head" shifts non-proportionally relative to the assembly center (deviation 15%). Derive its position from the driver sliders or use Align.',
    'At catSize decrease (0.6x), "body" shifts non-proportionally relative to the assembly center (deviation 12%).'
  ];
  const aggregated = aggregateAndRankIssues(rawIssues);
  assert.strictEqual(aggregated.length, 1);
  assert.ok(aggregated[0].includes('parts shift non-proportionally when "catSize" moves'));
  assert.ok(aggregated[0].includes('worst: "head" (15%)'));
  console.log('Test 4 passed.');
}

try {
  runTests();
  console.log('\nAll phantom error & validation tests PASSED!');
  process.exit(0);
} catch (err) {
  console.error('\nTest FAILED:', err);
  process.exit(1);
}
