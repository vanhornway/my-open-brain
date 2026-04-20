import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MCP_ACCESS_KEY = Deno.env.get('MCP_ACCESS_KEY')!

createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function slackJson(text: string, status = 200) {
  return new Response(
    JSON.stringify({
      response_type: 'ephemeral',
      text,
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}

function extractMcpText(responseText: string): string | null {
  const lines = responseText.split('\n')

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue

    const jsonPart = line.slice(6)

    try {
      const parsed = JSON.parse(jsonPart)
      const content = parsed?.result?.content

      if (Array.isArray(content) && content.length > 0) {
        const firstText = content.find((item: any) => item?.type === 'text' && typeof item?.text === 'string')
        if (firstText?.text) return firstText.text
      }

      const errorMessage = parsed?.error?.message
      if (typeof errorMessage === 'string') return errorMessage
    } catch {
      // Ignore malformed SSE chunks and keep scanning
    }
  }

  return null
}

async function callMcpTool(name: string, args: Record<string, unknown>, id: string) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/open-brain-mcp?key=${encodeURIComponent(MCP_ACCESS_KEY)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: {
          name,
          arguments: args,
        },
      }),
    }
  )

  const text = await response.text()

  console.log('mcp response', {
    tool: name,
    status: response.status,
    body: text,
  })

  return {
    ok: response.ok,
    status: response.status,
    body: text,
    parsedText: extractMcpText(text),
  }
}

Deno.serve(async (req) => {
  try {
    console.log('ingest-thought hit', {
      method: req.method,
      contentType: req.headers.get('content-type'),
      userAgent: req.headers.get('user-agent'),
    })

    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const contentType = (req.headers.get('content-type') || '').toLowerCase()

    let text = ''
    let channelId = ''
    let userId = ''
    let payloadType = 'unknown'

    if (contentType.includes('application/json')) {
      const body = await req.json()
      console.log('json body received', JSON.stringify(body))

      if (body?.type === 'url_verification' && body?.challenge) {
        console.log('handling slack url_verification')
        return new Response(body.challenge, {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        })
      }

      payloadType = 'json'
      text = body?.event?.text ?? body?.text ?? body?.content ?? ''
      channelId = body?.event?.channel ?? body?.channel_id ?? ''
      userId = body?.event?.user ?? body?.user_id ?? ''
    } else if (
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data')
    ) {
      const formData = await req.formData()
      const entries = Object.fromEntries(formData.entries())
      console.log('form body received', JSON.stringify(entries))

      payloadType = 'form'
      text =
        formData.get('text')?.toString() ||
        formData.get('content')?.toString() ||
        ''
      channelId = formData.get('channel_id')?.toString() || ''
      userId = formData.get('user_id')?.toString() || ''
    } else {
      console.log('unknown content type, attempting fallback parse')

      try {
        const formData = await req.formData()
        const entries = Object.fromEntries(formData.entries())
        console.log('fallback form body received', JSON.stringify(entries))

        payloadType = 'fallback-form'
        text =
          formData.get('text')?.toString() ||
          formData.get('content')?.toString() ||
          ''
        channelId = formData.get('channel_id')?.toString() || ''
        userId = formData.get('user_id')?.toString() || ''
      } catch {
        const body = await req.json()
        console.log('fallback json body received', JSON.stringify(body))

        payloadType = 'fallback-json'
        text = body?.event?.text ?? body?.text ?? body?.content ?? ''
        channelId = body?.event?.channel ?? body?.channel_id ?? ''
        userId = body?.event?.user ?? body?.user_id ?? ''
      }
    }

    text = text.trim()

    console.log('normalized payload', {
      payloadType,
      text,
      channelId,
      userId,
      allowedChannel: Deno.env.get('SLACK_CAPTURE_CHANNEL') || null,
    })

    if (!text) {
      return slackJson('❌ Error: No text found in request')
    }

    const allowedChannel = Deno.env.get('SLACK_CAPTURE_CHANNEL')
    if (allowedChannel && channelId && channelId !== allowedChannel) {
      console.log('message ignored due to channel mismatch', {
        channelId,
        allowedChannel,
      })
      return slackJson('ℹ️ Message ignored because it was not sent in the capture channel.')
    }

    const normalized = text.toLowerCase().trim()

    if (
      normalized === '/recall' ||
      normalized === 'recall' ||
      normalized === '/last' ||
      normalized === 'last'
    ) {
      const recallResponse = await callMcpTool(
        'list_thoughts',
        { limit: 5 },
        'slack-recall'
      )

      if (!recallResponse.ok) {
        return slackJson(`❌ Error: MCP recall failed (${recallResponse.status})`)
      }

      if (!recallResponse.parsedText) {
        return slackJson('❌ Error: MCP did not return a readable recall response')
      }

      return slackJson(`🧠 Your last 5 thoughts:\n\n${recallResponse.parsedText}`)
    }

    const mcpResponse = await callMcpTool(
      'capture_thought',
      { content: text },
      'slack-capture'
    )

    if (!mcpResponse.ok) {
      return slackJson(`❌ Error: MCP capture failed (${mcpResponse.status})`)
    }

    if (!mcpResponse.parsedText || !mcpResponse.parsedText.includes('Captured as')) {
      return slackJson('❌ Error: MCP did not confirm capture')
    }

    return slackJson(`🧠 Captured to your brain: "${text}"`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('ingest-thought error:', message)

    return slackJson(`❌ Error: ${message}`)
  }
})