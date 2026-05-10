// fixture: frontend
import { useState } from "react";
export function Show(decryptedAmount: bigint) {
    const [v] = useState(decryptedAmount);
    return v;
}
