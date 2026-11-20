import bwipjs from "bwip-js/node";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { decodeLinear } from "../src/lib/barcode";

async function picture(bcid: string, text: string) {
  const png = PNG.sync.read(await bwipjs.toBuffer({ bcid, text, scale: 3, height: 12, paddingwidth: 12, paddingheight: 12, backgroundcolor: "FFFFFF" }));
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
}

describe("barcode reading", () => {
  it("reads a Code 128 label carrying one of our label codes", async () => {
    const p = await picture("code128", "QB:0103466585728");
    expect(decodeLinear(p.data, p.width, p.height)).toBe("QB:0103466585728");
  });
  it("reads Code 39 and UPC labels", async () => {
    const a = await picture("code39", "HA2000H");
    expect(decodeLinear(a.data, a.width, a.height)).toBe("HA2000H");
    const b = await picture("upca", "036000291452");
    expect(decodeLinear(b.data, b.width, b.height)).toBe("036000291452");
  });
  it("returns nothing for a blank frame", () => {
    expect(decodeLinear(new Uint8ClampedArray(200 * 100 * 4).fill(255), 200, 100)).toBeNull();
  });
});
