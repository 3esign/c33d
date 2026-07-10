import { getOC, initReplicad } from "replicad";

async function main() {
  await initReplicad();
  const OC = getOC();
  console.log("BRepAlgoAPI_Splitter:", !!OC.BRepAlgoAPI_Splitter);
  console.log("BRepFeat_SplitShape:", !!OC.BRepFeat_SplitShape);
  console.log("BRepFeat_MakePrism:", !!OC.BRepFeat_MakePrism);
  console.log("BRepAlgoAPI_Section:", !!OC.BRepAlgoAPI_Section);
  console.log("BRepAlgoAPI_BooleanOperation:", !!OC.BRepAlgoAPI_BooleanOperation);
}
main().catch(console.error);
