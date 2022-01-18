const QRCode = require('qrcode');
const Jimp = require('jimp');
const qrCode = require('qrcode-reader');

/**
 * Interface with QR codes in a single place.  
 * 
 */
class QRCodeInterface {

  /**
   * 
   */
  constructor(){
  }

  /**
   * Get a QR code as a data URL, which can be displayed in the browser directly.
   * 
   * Data URLs are in the format 
   *    data:image/png;base64, <image data as base64>
   * 
   * @param {string} data the data to encode as a QR code.
   * @returns a QR representation of the passed in data as a data URL.
   * @throws error if there is an error encoding the string.
   */
  async getQrDataUrl(data) {
    try {
      const encodedData = await QRCode.toDataURL(
        data
      );
      return encodedData;
    } catch (error) {
      throw error;
    }    
  }

  /**
   * Decode QR data that is encoded as a base64 image.
   * 
   * @param {string} qrData A QR code image, encoded as a base64 image PNG.
   * @returns a string that was encoded as QR data.
   * @throws error if there is an error in any of these operations.
   */
  async decode(qrData) {
    const imageData = qrData.replace('data:image/png;base64,', '');
    const buffer = Buffer.from(imageData, 'base64');
    try {
      const image = await Jimp.read(buffer);
      let qrcode = new qrCode();

      qrcode.decode(image.bitmap);
      return qrcode.result.result;
    } catch (error) {
      throw error;
    }
  }

}

module.exports = QRCodeInterface;