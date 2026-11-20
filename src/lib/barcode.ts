// Reads ordinary (one-dimensional) barcodes from a camera frame, for browsers that have
// no built-in barcode reader. QR codes are read separately by jsQR.
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from "@zxing/library";

const FORMATS = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
];

let reader: MultiFormatReader | null = null;

/** The text of a barcode in an RGBA image, or null when none can be read. */
export function decodeLinear(rgba: Uint8ClampedArray, width: number, height: number): string | null {
  if (!reader) {
    reader = new MultiFormatReader();
    reader.setHints(new Map<DecodeHintType, unknown>([[DecodeHintType.POSSIBLE_FORMATS, FORMATS]]));
  }
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
  }
  try {
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(gray, width, height)));
    return reader.decodeWithState(bitmap).getText().trim() || null;
  } catch {
    return null; // nothing readable in this frame
  } finally {
    reader.reset();
  }
}
