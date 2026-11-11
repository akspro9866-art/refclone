// Photo-to-vector tracing for raster product screenshots. The implementation is
// the vendored framewright trace.py wrapper in src/ingest/photo-trace.mjs; this
// vision-side module is the stable entry point the ingest stage re-exports, so a
// caller may import either path. When python/numpy/scipy/Pillow are absent the
// underlying wrapper returns a blocked report naming the missing pieces — it
// never fabricates polygons.
export {
  PHOTO_TRACE_VERSION,
  DEFAULT_PHOTO_TRACE,
  parsePortrait,
  photoTrace
} from '../ingest/photo-trace.mjs';
export { photoTrace as tracePhoto } from '../ingest/photo-trace.mjs';
