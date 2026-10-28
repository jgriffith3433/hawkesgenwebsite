// Options every function shares. Imported first by index.ts: scheduled functions read them when their module loads.
import { setGlobalOptions } from 'firebase-functions';

setGlobalOptions({ region: 'us-east4', maxInstances: 10 });
