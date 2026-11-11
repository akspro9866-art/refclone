// Stage 1 (ingest) entry point for raster-to-vector tracing. Re-exports the
// vision tracer and adds an ingest-stage envelope so a product screenshot traced
// during ingestion is recorded next to the other ingest artifacts. The trace
// itself stays optional: a missing Python toolchain or unreadable image yields a
// blocked photo-trace report, never an invented polygon set.
import { photoTrace } from '../vision/trace.mjs';

export {
  PHOTO_TRACE_VERSION,
  DEFAULT_PHOTO_TRACE,
  parsePortrait,
  photoTrace,
  tracePhoto
} from '../vision/trace.mjs';

/**
 * Trace one raster product screenshot during ingestion.
 * @param {string} photo input image path
 * @param {{python?: string, jobsDirectory?: string, settings?: object}} [options]
 * @returns {Promise<object>} the photoTrace cache envelope plus `stage`/`kind`
 */
export async function ingestTrace(photo, options = {}) {
  const envelope = await photoTrace(photo, options);
  return { ...envelope, stage: 'ingest', kind: 'photo-trace' };
}
