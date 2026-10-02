// The document viewer's script is inlined into its sandboxed iframe (srcdoc). Shared with
// vite.config.ts, which allows exactly this script in the website's Content-Security-Policy by hash.

/** The script as it appears between <script> and </script>: "</script" inside it must not end the tag early. */
export function inlineScript(code: string): string {
  return code.replace(/<\/script/gi, '<\/script')
}
