/** Runtime version supplied by the public plugin SDK, never a copied release pin. */
import type { OpenClawPluginApi } from './sdk.js';
/** Read the executing Gateway version through its public SDK runtime. */
export function runtimeVersion(api:OpenClawPluginApi):string{return api.runtime?.version??'unavailable';}
