/** An encrypted report: says it exists, for whom, and its size. The ciphertext is never decoded or shown (its size
 *  comes from the base64 length alone). */
export function Sealed({ b64, who }: { b64: string | null | undefined; who: string }) {
  if (!b64) return null;
  const clean = b64.replace(/\s/g, "");
  const bytes = Math.max(0, Math.floor((clean.length * 3) / 4) - (clean.match(/=*$/)?.[0].length ?? 0));
  return (
    <span className="whitespace-nowrap text-[13px] text-fg-2" title={`ECIES ciphertext, ${bytes} bytes. Only the ${who} can decrypt it.`}>
      Report sealed for the {who} ({bytes} bytes)
    </span>
  );
}
