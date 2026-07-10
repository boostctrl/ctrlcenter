// Hand the browser a JSON file with no server round-trip — the one way a
// client-side export can produce a download. The anchor goes into the DOM
// because some browsers ignore clicks on detached elements, and revocation is
// deferred a tick so the download stream can open before the blob URL dies.
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
