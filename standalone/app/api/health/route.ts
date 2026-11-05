export function GET() {
  return Response.json({
    status: "healthy",
    service: "Archindus",
    experiences: ["archindus"],
    checkedAt: new Date().toISOString(),
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
