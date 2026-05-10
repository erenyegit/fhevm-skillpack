// fixture: frontend
import { useEncrypt } from "@zama-fhe/react-sdk";
export function MyComponent() {
    const encrypt = useEncrypt();
    return encrypt;
}
