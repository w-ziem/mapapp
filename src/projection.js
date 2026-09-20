import proj4 from "proj4";
import { register } from "ol/proj/proj4.js";
import { get as getProjection } from "ol/proj.js";

export function registerPolandProjection() {
  proj4.defs("EPSG:2180", "+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs");
  register(proj4);
  const projection = getProjection("EPSG:2180");
  projection.setExtent([100000, 100000, 900000, 850000]);
  return projection;
}
