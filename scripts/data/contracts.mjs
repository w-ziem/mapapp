/**
 * @typedef {"landing-page"|"wfs"|"direct"} SourceKind
 * @typedef {{sourceCrs:"EPSG:4326", axisOrder:"yx"}} SourceSchema
 * @typedef {{effectiveUrl:string, fileName:string, sizeBytes:number, sha256:string}} LockedArtifact
 * @typedef {{
 *   id:string,
 *   institution:string,
 *   dataset:string,
 *   landingPage:string,
 *   retrievedAt:string,
 *   validAt:string,
 *   license:string,
 *   attribution:string,
 *   artifacts:LockedArtifact[]
 * }} LockedSource
 * @typedef {{version:1, sources:LockedSource[]}} SourceLock
 * @typedef {{rank:number, name:string, cityId:string, population:number}} PopulationRecord
 */

export const SOURCE_LOCK_VERSION = 1;
export const WFS_VERSION = "2.0.0";
