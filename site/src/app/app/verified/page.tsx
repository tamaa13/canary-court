import { redirect } from "next/navigation";

// (Verified is now Proof's "Enclave & model" part)
export default function VerifiedPage() {
  redirect("/app/proof?view=enclave");
}
