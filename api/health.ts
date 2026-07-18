export default function handler(_request: unknown, response: { status: (code: number) => { json: (body: unknown) => void } }) {
  response.status(200).json({
    service: 'abby',
    status: 'ok',
    mode: 'cloud-demo',
    timestamp: new Date().toISOString(),
  })
}
