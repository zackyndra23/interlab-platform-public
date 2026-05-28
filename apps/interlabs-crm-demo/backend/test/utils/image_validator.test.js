'use strict';
const { validateImageBuffer, ACCEPTED_MIMES, MAX_BYTES } = require('../../src/utils/image_validator');

// Magic-byte starters for PNG and JPEG
function pngBytes() {
  return Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
                      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1]);
}
function jpegBytes() {
  return Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]);
}

describe('image_validator', () => {
  it('exports a list of accepted mimes (png, jpeg, webp)', () => {
    expect(ACCEPTED_MIMES).toEqual(expect.arrayContaining(['image/png','image/jpeg','image/webp']));
    expect(ACCEPTED_MIMES).not.toContain('image/svg+xml');
  });

  it('exports MAX_BYTES around 5 MiB', () => {
    expect(MAX_BYTES).toBeGreaterThanOrEqual(1024 * 1024);
    expect(MAX_BYTES).toBeLessThanOrEqual(10 * 1024 * 1024);
  });

  it('accepts a valid PNG buffer', async () => {
    const r = await validateImageBuffer(pngBytes());
    expect(r.ok).toBe(true);
    expect(r.mime).toBe('image/png');
  });

  it('accepts a valid JPEG buffer', async () => {
    const r = await validateImageBuffer(jpegBytes());
    expect(r.ok).toBe(true);
    expect(r.mime).toMatch(/jpeg/);
  });

  it('rejects bytes that do not match a known image format', async () => {
    const r = await validateImageBuffer(Buffer.from('this is not an image'));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not an image|unsupported/i);
  });

  it('rejects oversized buffer', async () => {
    const big = Buffer.alloc(MAX_BYTES + 1, 0xFF);
    const r = await validateImageBuffer(big);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/too large|exceeds/i);
  });

  it('rejects SVG bytes (text/xml not in accepted list)', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const r = await validateImageBuffer(svg);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not an image|unsupported/i);
  });
});
