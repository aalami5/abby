import {
  BarVisualizer,
  LiveKitRoom,
  RoomAudioRenderer,
  VoiceAssistantControlBar,
  useRoomContext,
  useVoiceAssistant,
} from '@livekit/components-react'
import { ChevronDown, Mic, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createVoiceConnection } from './patientApi'
import type { VoiceConnection } from './patientTypes'

type Props = {
  token: string
  providerName: string
  onClose: () => void
}

function VoiceExperience({ providerName, onClose }: Pick<Props, 'providerName' | 'onClose'>) {
  const { state, audioTrack, agentTranscriptions } = useVoiceAssistant()
  const room = useRoomContext()
  const latest = agentTranscriptions.at(-1)?.text

  const close = async () => {
    await room.disconnect()
    onClose()
  }

  return (
    <div className="patient-voice-experience">
      <header className="patient-voice-header">
        <button type="button" onClick={close} aria-label="Close voice conversation"><ChevronDown /></button>
        <div><strong>Voice with Abby</strong><span><ShieldCheck size={13} /> Following {providerName}’s plan</span></div>
        <span className="voice-connection-dot" />
      </header>
      <main className="patient-voice-stage">
        <div className={`patient-voice-orb ${state}`}>
          <BarVisualizer state={state} trackRef={audioTrack} barCount={7} />
        </div>
        <h1>{state === 'speaking' ? 'Abby is speaking' : state === 'listening' ? 'I’m listening' : state === 'thinking' ? 'One moment' : 'Talk when you’re ready'}</h1>
        <p>{latest || 'You can interrupt at any time. Your conversation stays connected to this care plan.'}</p>
      </main>
      <div className="patient-voice-controls">
        <VoiceAssistantControlBar controls={{ microphone: true, leave: false }} />
        <span><Mic size={14} /> Tap the microphone to mute</span>
      </div>
      <RoomAudioRenderer />
    </div>
  )
}

export function PatientVoiceRoom({ token, providerName, onClose }: Props) {
  const [connection, setConnection] = useState<VoiceConnection>()
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    createVoiceConnection(token)
      .then((next) => { if (active) setConnection(next) })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : String(caught)) })
    return () => { active = false }
  }, [token])

  if (error) {
    return (
      <div className="voice-loading-screen">
        <img src="/brand/abby-mark-circle.png" alt="" />
        <h1>Voice isn’t connected yet</h1>
        <p>{error}</p>
        <button type="button" onClick={onClose}>Continue by text</button>
      </div>
    )
  }

  if (!connection) {
    return (
      <div className="voice-loading-screen">
        <div className="voice-loading-orb"><span /><span /><span /></div>
        <h1>Opening your private voice session</h1>
        <p>This usually takes just a moment.</p>
      </div>
    )
  }

  return (
    <LiveKitRoom
      token={connection.participantToken}
      serverUrl={connection.serverUrl}
      connect
      audio
      className="patient-voice-room"
      onDisconnected={onClose}
    >
      <VoiceExperience providerName={providerName} onClose={onClose} />
    </LiveKitRoom>
  )
}
