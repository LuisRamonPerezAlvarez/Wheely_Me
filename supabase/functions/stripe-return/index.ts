// @ts-nocheck
Deno.serve(request => {
  const status = new URL(request.url).searchParams.get('status');
  const message = status === 'success'
    ? 'Pago de prueba completado. Ya puedes cerrar esta pestaña y regresar a Wheely Me.'
    : 'Pago de prueba cancelado. Ya puedes cerrar esta pestaña y regresar a Wheely Me.';

  return new Response(message, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
});
