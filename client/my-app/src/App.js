// File: App.js
import React, { useEffect, useRef, useState } from 'react';
import './App.css';

const SIGNAL_SERVER_URL = process.env.REACT_APP_SIGNAL_SERVER_URL; // Replace with actual deployed WebSocket server URL

let wakeLock = null;

function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [incomingCall, setIncomingCall] = useState(false);
  const [isSpeakerphone, setIsSpeakerphone] = useState(false);
  const pcOfferRef = useRef(null); 
  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const queuedCandidates = useRef([]);

  // Helper to get user IDs from URL hash (simple demo logic)
  const getUserIds = () => {
    const currentUserId = window.location.hash.replace('#', '');
    const otherUserId = currentUserId === 'user1' ? 'user2' : 'user1';
    return { currentUserId, otherUserId };
  };
  
const requestWakeLock = async () => {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Wake lock is active');
    }
  } catch (err) {
    console.error('Failed to acquire wake lock:', err);
  }
};

const releaseWakeLock = () => {
  if (wakeLock) {
    wakeLock.release().then(() => {
      console.log('Wake lock released');
      wakeLock = null;
    });
  }
};

const handleVisibilityChange = () => {
  if (document.visibilityState === 'visible') {
    if (callActive) {
      requestWakeLock();
    }
  } else {
    releaseWakeLock();
  }
};

  useEffect(() => {
    if (!loggedIn) return;

    // Initialize peer connection and gather ICE candidates early
    createPeerConnection();

    // Monitor network conditions
    monitorNetworkConditions();

    wsRef.current = new WebSocket(SIGNAL_SERVER_URL);

    wsRef.current.onopen = () => {
      console.log('WebSocket connected');
      wsRef.current.send(JSON.stringify({ type: 'login', username }));
    };

    wsRef.current.onmessage = async (message) => {
      const data = JSON.parse(message.data);
      console.log('Received message:', data.type);
    
      switch (data.type) {
        case 'partner_online':
          setPartnerOnline(true);
          break;
    
        case 'partner_offline':
          setPartnerOnline(false);
          setCallActive(false);
          break;
    
        case 'offer': {
          // Incoming offer - prompt user to accept
          console.log('Incoming offer received');
          setIncomingCall(true);
          // Save the offer SDP to a ref so we can use it later when accepting the call
          pcOfferRef.current = data.offer; // create a new ref to store the offer SDP
          break;
        }
    
        case 'answer': {
          if (!pcRef.current) return;
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
          setCallActive(true);
          break;
        }
    
        case 'candidate': {
          if (!pcRef.current) return;
    
          if (pcRef.current.remoteDescription && pcRef.current.remoteDescription.type) {
            try {
              await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
              console.log('Added ICE candidate');
            } catch (err) {
              console.error('Error adding ICE candidate:', err);
            }
          } else {
            console.log('Queueing ICE candidate because remoteDescription is not set yet');
            queuedCandidates.current.push(new RTCIceCandidate(data.candidate));
          }
          break;
        }
    
        case 'reject': {
          console.log('Call was rejected by the other user');
          hangUp();
          break;
        }
    
        default:
          console.warn('Unknown message type:', data.type);
      }
    };
    

    wsRef.current.onclose = () => {
      console.log('WebSocket disconnected');
      setPartnerOnline(false);
      setCallActive(false);
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    };

    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      queuedCandidates.current = [];
      releaseWakeLock();
    };
  }, [loggedIn, username]);

  useEffect(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [callActive]);

  // Drain queued ICE candidates after remoteDescription is set
  const processQueuedCandidates = async () => {
    while (queuedCandidates.current.length > 0) {
      const candidate = queuedCandidates.current.shift();
      try {
        await pcRef.current.addIceCandidate(candidate);
        console.log('Processed queued ICE candidate');
      } catch (e) {
        console.error('Error processing queued ICE candidate:', e);
      }
    }
  };

  const createPeerConnection = async () => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    

    pcRef.current = new RTCPeerConnection({
      iceServers: [
        // Primary ICE servers
        {
          urls: ["stun:bn-turn2.xirsys.com"]
        },
        {
          username: "SkG8Kog7CElvNpiLmt9TY7rayhljky_veLkVTg_Cybk-dsW2dL6Px7qXcQeLP4VKAAAAAGgvaR92YW5zaHJhZ2hhdg==",
          credential: "5dc3e010-3738-11f0-8c7e-0242ac140004",
          urls: [
            "turn:bn-turn2.xirsys.com:80?transport=udp",
            "turn:bn-turn2.xirsys.com:3478?transport=udp",
            "turn:bn-turn2.xirsys.com:80?transport=tcp",
            "turn:bn-turn2.xirsys.com:3478?transport=tcp",
            "turns:bn-turn2.xirsys.com:443?transport=tcp",
            "turns:bn-turn2.xirsys.com:5349?transport=tcp"
          ]
        },
        // Fallback ICE servers
        {
          urls: "stun:stun.relay.metered.ca:80",
        },
        {
          urls: "turn:global.relay.metered.ca:80",
          username: "1d5e87c52e2d9f94d3584f49",
          credential: "3yKvWb37DyCG5243",
        },
        {
          urls: "turn:global.relay.metered.ca:80?transport=tcp",
          username: "1d5e87c52e2d9f94d3584f49",
          credential: "3yKvWb37DyCG5243",
        },
        {
          urls: "turn:global.relay.metered.ca:443",
          username: "1d5e87c52e2d9f94d3584f49",
          credential: "3yKvWb37DyCG5243",
        },
        {
          urls: "turns:global.relay.metered.ca:443?transport=tcp",
          username: "1d5e87c52e2d9f94d3584f49",
          credential: "3yKvWb37DyCG5243",
        }
      ],
    });

    console.log('Configured ICE servers:', pcRef.current.getConfiguration().iceServers);

    console.log(pcRef.current);

    try {
      console.log('Requesting user media...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      console.log('Got local stream with tracks:', stream.getTracks().length);
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream;
      }

      // Add all audio tracks to peer connection
      stream.getTracks().forEach((track) => {
        console.log('Adding track to peer connection:', track.kind);
        pcRef.current.addTrack(track, stream);
      });
    } catch (err) {
      console.error('Error accessing media devices:', err);
    }

    pcRef.current.ontrack = (event) => {
      const [stream] = event.streams;
      console.log('Remote track received:', event.track.kind);
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.muted = false;
        remoteAudioRef.current.volume = 1.0;
        remoteAudioRef.current.playsInline = true;
    
        // Try to play right away
        remoteAudioRef.current.play().catch((err) => {
          console.warn('Autoplay prevented:', err);
          // Optionally inform the user to click to play audio
        });
      }
    };
    

    pcRef.current.onicecandidate = (e) => {
      if (e.candidate) {
        console.log('New ICE candidate:', e.candidate.candidate);
        const { otherUserId } = getUserIds();
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'candidate', candidate: e.candidate, to: otherUserId }));
        }
      } else {
        console.log('ICE candidate gathering complete');
      }
    };

    pcRef.current.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pcRef.current.iceConnectionState);
      if (pcRef.current.iceConnectionState === 'failed') {
        console.log('ICE failed, restarting ICE');
        pcRef.current.restartIce();
      }
    };

    pcRef.current.onconnectionstatechange = () => {
      console.log('Connection state:', pcRef.current.connectionState);
      if (pcRef.current.connectionState === 'failed') {
        console.log('Connection failed, attempting to restart');
        // Add logic to restart or handle failed connection
      }
    };
  };

  const acceptCall = async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket is not open, cannot accept call');
      return;
    }
  
    await createPeerConnection();
  
    if (!pcOfferRef.current) {
      console.error('No offer SDP available to accept');
      return;
    }
  
    try {
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(pcOfferRef.current));
      await processQueuedCandidates(); // process any queued ICE candidates after setting remote desc
  
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
  
      const { otherUserId } = getUserIds();
      wsRef.current.send(JSON.stringify({ type: 'answer', answer, to: otherUserId }));
  
      setIncomingCall(false);
      setCallActive(true);
  
      // Clear saved offer SDP after accepting
      pcOfferRef.current = null;
    } catch (err) {
      console.error('Error accepting call:', err);
    }
  };
  const rejectCall = () => {
    setIncomingCall(false);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'reject', to: getUserIds().otherUserId }));
    }
  };

  const hangUp = () => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localAudioRef.current) {
      localAudioRef.current.srcObject = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    setCallActive(false);
    setIsMuted(false);
    releaseWakeLock(); // Release wake lock when call ends
  };

  const toggleMute = () => {
    if (!pcRef.current) return;
    
    const tracks = pcRef.current.getSenders().map(sender => sender.track);
    const audioTracks = tracks.filter(track => track?.kind === 'audio');
    
    const newMuteState = !isMuted;
    audioTracks.forEach(track => {
      if (track) {
        track.enabled = !newMuteState;
      }
    });
    setIsMuted(newMuteState);
  };

  const toggleSpeakerphone = () => {
    if (remoteAudioRef.current) {
      const audioElement = remoteAudioRef.current;
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaElementSource(audioElement);
      const destination = audioContext.destination;
      source.connect(destination);
      setIsSpeakerphone(!isSpeakerphone);
    }
  };

  const startCall = async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket is not open, cannot start call');
      return;
    }

    await createPeerConnection();

    const { currentUserId, otherUserId } = getUserIds();

    try {
      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);
      wsRef.current.send(JSON.stringify({
        type: 'offer',
        offer,
        from: currentUserId,
        to: otherUserId,
      }));
      console.log('Offer sent');
      requestWakeLock(); // Request wake lock when call starts
    } catch (err) {
      console.error('Error starting call:', err);
    }
  };

  const monitorNetworkConditions = () => {
    setInterval(() => {
      if (navigator.connection) {
        const { downlink, effectiveType } = navigator.connection;
        console.log(`Network downlink: ${downlink}, effective type: ${effectiveType}`);

        // Adjust settings based on network conditions
        if (effectiveType.includes('2g') || downlink < 0.5) {
          console.log('Poor network conditions detected, adjusting settings...');
          // Reduce bitrate for audio tracks
          pcRef.current.getSenders().forEach(sender => {
            if (sender.track.kind === 'audio') {
              const params = sender.getParameters();
              if (!params.encodings) params.encodings = [{}];
              params.encodings[0].maxBitrate = 20000; // Lower bitrate to 20 kbps
              sender.setParameters(params).catch(err => console.error('Failed to set parameters:', err));
            }
          });
        } else {
          console.log('Good network conditions, setting normal bitrate...');
          // Reset bitrate to normal for audio tracks
          pcRef.current.getSenders().forEach(sender => {
            if (sender.track.kind === 'audio') {
              const params = sender.getParameters();
              if (!params.encodings) params.encodings = [{}];
              params.encodings[0].maxBitrate = 64000; // Normal bitrate 64 kbps
              sender.setParameters(params).catch(err => console.error('Failed to set parameters:', err));
            }
          });
        }
      }
    }, 5000); // Check every 5 seconds
  };

  if (!loggedIn) {
    return (
      <div className="login">
        <h2>Private Call App</h2>
        <input
          placeholder="Enter your name"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <button onClick={() => setLoggedIn(true)} disabled={!username.trim()}>
          Login
        </button>
      </div>
    );
  }

  return (
    <div className="app" style={{ padding: 20, textAlign: 'center' }}>
      <h1>Audio Call App</h1>
      <div className="status" style={{ margin: '20px 0', color: partnerOnline ? 'green' : 'orange' }}>
        {partnerOnline ? 'Partner Online' : 'Waiting for partner...'}
      </div>

      {incomingCall && (
        <div style={{ marginTop: 20 }}>
          <p>Incoming Call...</p>
          <button
            onClick={acceptCall}
            style={{
              marginRight: 10,
              padding: '8px 16px',
              fontSize: 14,
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer'
            }}
          >
            Accept
          </button>
          <button
            onClick={rejectCall}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              backgroundColor: '#ff4444',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer'
            }}
          >
            Reject
          </button>
        </div>
      )}

      {partnerOnline && !callActive && !incomingCall && (
        <button
          onClick={startCall}
          style={{
            padding: '10px 20px',
            fontSize: 16,
            cursor: 'pointer',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: 4
          }}
        >
          Start Call
        </button>
      )}

      <div style={{ marginTop: 20 }}>
        {/* Hidden local audio (muted) */}
        <audio ref={localAudioRef} autoPlay playsInline muted style={{ display: 'none' }} />

        <div>
          <p>Remote Audio:</p>
          <audio ref={remoteAudioRef} controls style={{ width: 300 }} playsInline />
        </div>

        {callActive && (
          <div style={{ marginTop: 20 }}>
            <button
              onClick={toggleMute}
              style={{
                marginRight: 10,
                padding: '8px 16px',
                fontSize: 14,
                backgroundColor: isMuted ? '#ff4444' : '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer'
              }}
            >
              {isMuted ? 'Unmute' : 'Mute'} Mic
            </button>
            <button
              onClick={toggleSpeakerphone}
              style={{
                marginRight: 10,
                padding: '8px 16px',
                fontSize: 14,
                backgroundColor: isSpeakerphone ? '#4CAF50' : '#ff4444',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer'
              }}
            >
              {isSpeakerphone ? 'Disable Speakerphone' : 'Enable Speakerphone'}
            </button>
            <button
              onClick={hangUp}
              style={{
                padding: '8px 16px',
                fontSize: 14,
                backgroundColor: '#ff4444',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer'
              }}
            >
              Hang Up
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
