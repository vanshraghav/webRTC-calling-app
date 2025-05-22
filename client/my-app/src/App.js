// File: App.js
import React, { useEffect, useRef, useState } from 'react';
import './App.css';

const SIGNAL_SERVER_URL = process.env.REACT_APP_SIGNAL_SERVER_URL; // Replace with actual deployed WebSocket server URL

function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [incomingCall, setIncomingCall] = useState(false);
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

  useEffect(() => {
    if (!loggedIn) return;

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
    };
  }, [loggedIn, username]);

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
    

    pcRef.current =  new RTCPeerConnection({
      iceServers: [
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
          },
      ],
    });

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

  const startCall = async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket is not open, cannot start call');
      return;
    }

    await createPeerConnection();

    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);

    const { otherUserId } = getUserIds();
    wsRef.current.send(JSON.stringify({ type: 'offer', offer, to: otherUserId }));

    setCallActive(true);
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
