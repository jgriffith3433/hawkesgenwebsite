// Options every function shares. Imported first by index.ts: scheduled functions read them when their module loads.
import { setGlobalOptions } from 'firebase-functions';

// cpu 'gcf_gen1': a fraction of a vCPU sized by memory (0.167 at 256 MiB). The schedules run every minute or two, so their
// instances never idle out, and at a whole vCPU each they held 7 of the region's 20 (Cloud Run quota, shared with Gen,
// Studio and Unity builds in the same project; 2026-10-29). They mostly wait on Gen. api sets its own (concurrency needs 1).
setGlobalOptions({ region: 'us-east4', maxInstances: 10, cpu: 'gcf_gen1' });
