import JSZip from "jszip";

/**
 * .ork files are a zip container: `rocket.ork` (the XML) plus optional
 * `decals/*.png` assets we don't need. Confirmed structure by unzipping real
 * example files from OpenRocket's own examples directory.
 */
export async function unzipOrkXml(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file("rocket.ork");
  if (!entry) {
    throw new Error(".ork file does not contain a rocket.ork entry — not a valid OpenRocket file");
  }
  return entry.async("text");
}
