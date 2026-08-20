import { ARCHITECTURAL_EXECUTORS } from './architectural.ts';
import { ORGANIC_EXECUTORS } from './organic.ts';
import { ENGINEERING_EXECUTORS } from './engineering.ts';
import { GENERATIVE_EXECUTORS } from './generative.ts';
import { ANALYSIS_EXECUTORS } from './analysis.ts';

export { ARCHITECTURAL_EXECUTORS } from './architectural.ts';
export { ORGANIC_EXECUTORS } from './organic.ts';
export { ENGINEERING_EXECUTORS } from './engineering.ts';
export { GENERATIVE_EXECUTORS } from './generative.ts';
export { ANALYSIS_EXECUTORS } from './analysis.ts';

export const ALL_DOMAIN_EXECUTORS: Record<string, (params: any, inputs: any[], warn: (msg: string) => void) => any> = {
  ...ARCHITECTURAL_EXECUTORS,
  ...ORGANIC_EXECUTORS,
  ...ENGINEERING_EXECUTORS,
  ...GENERATIVE_EXECUTORS,
  ...ANALYSIS_EXECUTORS
};
