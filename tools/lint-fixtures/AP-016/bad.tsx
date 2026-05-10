// fixture: frontend
import { useRouter } from "next/navigation";
export function Show(decryptedAmount: bigint) {
    const router = useRouter();
    router.push(`/result?cleartext=${decryptedAmount}`);
}
