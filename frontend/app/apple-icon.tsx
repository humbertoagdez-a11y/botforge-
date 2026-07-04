import { ImageResponse } from 'next/og';

// Apple touch icon (Next.js lo genera como PNG 180x180 desde este JSX).
// Mismo robot del favicon, con fondo solido: iOS no soporta transparencia
// en touch icons (la rellena de negro).
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#07070E',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          {/* Antena */}
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              background: '#22D3EE',
            }}
          />
          <div style={{ width: 10, height: 16, background: '#22D3EE' }} />
          {/* Cabeza */}
          <div
            style={{
              width: 124,
              height: 104,
              borderRadius: 34,
              background: 'linear-gradient(135deg, #7C3AED, #4F46E5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 22,
            }}
          >
            {/* Ojos rectangulares cian */}
            <div style={{ width: 26, height: 38, borderRadius: 10, background: '#22D3EE' }} />
            <div style={{ width: 26, height: 38, borderRadius: 10, background: '#22D3EE' }} />
          </div>
        </div>
      </div>
    ),
    size,
  );
}
