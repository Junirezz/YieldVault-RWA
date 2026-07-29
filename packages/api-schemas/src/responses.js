"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VaultOperationResponseSchema = void 0;
const zod_1 = require("zod");
const primitives_1 = require("./primitives");
/** Successful vault deposit / withdrawal response body. */
exports.VaultOperationResponseSchema = zod_1.z
    .object({
    id: zod_1.z.string(),
    type: zod_1.z.enum(["deposit", "withdrawal"]),
    amount: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]),
    asset: primitives_1.AssetCodeSchema,
    walletAddress: primitives_1.StellarAddressSchema,
    transactionHash: zod_1.z.string(),
    status: zod_1.z.string(),
    timestamp: zod_1.z.string(),
})
    .strict();
//# sourceMappingURL=responses.js.map