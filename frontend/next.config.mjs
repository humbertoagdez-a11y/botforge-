/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // El panel de origen vive bajo /dashboard para heredar la sesion y para
      // quedar dentro de las rutas que el pixel de Meta no mide. La
      // redireccion es del servidor: ningun script corre en /admin/origen.
      { source: '/admin/origen', destination: '/dashboard/admin/origen', permanent: false },
    ];
  },
};

export default nextConfig;
