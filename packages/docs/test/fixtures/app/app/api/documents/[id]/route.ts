export async function GET(): Promise<Response> {
  return new Response(null);
}

export async function DELETE(): Promise<Response> {
  return new Response(null, { status: 204 });
}

export async function POST(): Promise<Response> {
  return new Response(null);
}
