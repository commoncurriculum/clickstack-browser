import { t as __exportAll } from "./rolldown-runtime.js";
import { record } from "@rrweb/record";
// src/replay/rrweb.ts
var rrweb_exports = /* @__PURE__ */ __exportAll({ maskedRecord: () => maskedRecord });
const MASK_ALL_INPUTS = {
	input: true,
	textarea: true,
	select: true
};
/**
* `record` from `@rrweb/record`, masking as chosen.
*
* @internal
*/
function maskedRecord(masking) {
	function masked(options) {
		return record({
			...options,
			...masking.maskAllText ? { maskTextSelector: "*" } : {},
			maskInputOptions: masking.maskAllInputs ? MASK_ALL_INPUTS : { password: true },
			userTriggeredOnInput: true
		});
	}
	masked.takeFullSnapshot = record.takeFullSnapshot;
	masked.mirror = record.mirror;
	return masked;
}
export { rrweb_exports as n, maskedRecord as t };

//# sourceMappingURL=rrweb.js.map