import "ol/ol.css";
import "./styles.css";
import { registerPolandProjection } from "./projection.js";
import { startApp } from "./app.js";

registerPolandProjection();
startApp().catch(() => {});
