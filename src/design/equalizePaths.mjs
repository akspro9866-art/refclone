// Design-stage entry point for segment-matched vector paths. The implementation
// lives in src/cavalry/equalizePaths.mjs so compiler and design code share one
// wrapper around svg-path-commander; re-exported here because design compilation
// (icon/shape morph resolution) is a design-stage concern.
export {
  EQUALIZE_PATHS_VERSION,
  equalizePaths,
  equalizeSegments,
  transform3d
} from '../cavalry/equalizePaths.mjs';
