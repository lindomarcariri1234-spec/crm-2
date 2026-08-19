function crc16(data: string): string {
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function emvField(id: string, value: string): string {
  const len = String(value.length).padStart(2, "0");
  return `${id}${len}${value}`;
}

export interface PixPayload {
  key: string;
  name: string;
  city: string;
  amount: number;
  txid?: string;
  description?: string;
}

export function generatePixEMV(payload: PixPayload): string {
  const { key, name, city, amount, txid = "***", description = "Assinatura VisiteCRM" } = payload;

  const safeName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").slice(0, 25).toUpperCase();
  const safeCity = city.normalize("NFD").replace(/[\u0300-\u036f]/g, "").slice(0, 15).toUpperCase();

  const pixKeyField = emvField("01", key);
  const descField = description ? emvField("02", description.slice(0, 40)) : "";
  const merchantAccountInfo = emvField("00", "br.gov.bcb.pix") + pixKeyField + descField;

  const additionalData = emvField("05", txid.slice(0, 25));

  const amountStr = amount.toFixed(2);

  let emv =
    emvField("00", "01") +
    emvField("26", merchantAccountInfo) +
    emvField("52", "0000") +
    emvField("53", "986") +
    emvField("54", amountStr) +
    emvField("58", "BR") +
    emvField("59", safeName) +
    emvField("60", safeCity) +
    emvField("62", additionalData) +
    "6304";

  emv += crc16(emv);
  return emv;
}

export function generatePixQrCodeUrl(pixCode: string): string {
  const encoded = encodeURIComponent(pixCode);
  return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encoded}`;
}
