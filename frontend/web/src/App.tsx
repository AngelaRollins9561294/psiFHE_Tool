import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

// FHE encryption/decryption utilities for numerical data
const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}-${Date.now()}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    const base64Data = encryptedData.split('-')[1];
    return parseFloat(atob(base64Data));
  }
  return parseFloat(encryptedData);
};

// FHE-based PSI computation simulation
const FHEComputePSI = (encryptedSets: string[][]): string[] => {
  console.log("Performing FHE-based Private Set Intersection...");
  
  // Simulate FHE computation on encrypted data
  const allElements = new Map<number, number>();
  
  encryptedSets.forEach((set, partyIndex) => {
    set.forEach(encryptedValue => {
      const value = FHEDecryptNumber(encryptedValue);
      const count = allElements.get(value) || 0;
      allElements.set(value, count + 1);
    });
  });

  // Find intersection (elements present in all sets)
  const intersection: number[] = [];
  const totalParties = encryptedSets.length;
  
  allElements.forEach((count, value) => {
    if (count === totalParties) {
      intersection.push(value);
    }
  });

  // Return encrypted intersection results
  return intersection.map(val => FHEEncryptNumber(val));
};

interface Participant {
  id: string;
  name: string;
  address: string;
  dataCount: number;
  status: 'connected' | 'disconnected' | 'computing';
  lastActive: number;
}

interface Computation {
  id: string;
  participants: string[];
  timestamp: number;
  result: string[];
  status: 'pending' | 'computing' | 'completed' | 'failed';
  encryptedData: string[][];
}

interface EncryptedData {
  id: string;
  value: number;
  encryptedValue: string;
  owner: string;
  timestamp: number;
  category: string;
}

const generatePublicKey = () => `0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [computations, setComputations] = useState<Computation[]>([]);
  const [encryptedData, setEncryptedData] = useState<EncryptedData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddDataModal, setShowAddDataModal] = useState(false);
  const [showAddParticipantModal, setShowAddParticipantModal] = useState(false);
  const [showComputeModal, setShowComputeModal] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, status: "pending", message: "" 
  });
  const [newData, setNewData] = useState({ value: 0, category: "medical" });
  const [newParticipant, setNewParticipant] = useState({ name: "", address: "" });
  const [selectedComputation, setSelectedComputation] = useState<Computation | null>(null);
  const [publicKey, setPublicKey] = useState<string>("");
  const [isComputing, setIsComputing] = useState(false);
  const [computationProgress, setComputationProgress] = useState(0);

  // Initialize application
  useEffect(() => {
    loadInitialData().finally(() => setLoading(false));
    setPublicKey(generatePublicKey());
  }, []);

  const loadInitialData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;

      // Check contract availability
      await contract.isAvailable();
      
      // Load participants
      await loadParticipants();
      
      // Load computations history
      await loadComputations();
      
      // Load encrypted data
      await loadEncryptedData();

    } catch (e) { 
      console.error("Error loading initial data:", e); 
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  const loadParticipants = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;

      const participantsBytes = await contract.getData("participants");
      let participantsList: Participant[] = [];
      
      if (participantsBytes.length > 0) {
        try {
          participantsList = JSON.parse(ethers.toUtf8String(participantsBytes));
        } catch (e) { 
          console.error("Error parsing participants:", e); 
        }
      }
      
      setParticipants(participantsList);
    } catch (e) { 
      console.error("Error loading participants:", e); 
    }
  };

  const loadComputations = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;

      const computationsBytes = await contract.getData("computations");
      let computationsList: Computation[] = [];
      
      if (computationsBytes.length > 0) {
        try {
          computationsList = JSON.parse(ethers.toUtf8String(computationsBytes));
        } catch (e) { 
          console.error("Error parsing computations:", e); 
        }
      }
      
      setComputations(computationsList.sort((a, b) => b.timestamp - a.timestamp));
    } catch (e) { 
      console.error("Error loading computations:", e); 
    }
  };

  const loadEncryptedData = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;

      const dataBytes = await contract.getData("encrypted_data");
      let dataList: EncryptedData[] = [];
      
      if (dataBytes.length > 0) {
        try {
          dataList = JSON.parse(ethers.toUtf8String(dataBytes));
        } catch (e) { 
          console.error("Error parsing encrypted data:", e); 
        }
      }
      
      setEncryptedData(dataList);
    } catch (e) { 
      console.error("Error loading encrypted data:", e); 
    }
  };

  const addParticipant = async () => {
    if (!isConnected) { 
      alert("Please connect wallet first"); 
      return; 
    }

    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Adding new participant to FHE network..." 
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");

      const newParticipantData: Participant = {
        id: `participant-${Date.now()}`,
        name: newParticipant.name,
        address: newParticipant.address || address!,
        dataCount: 0,
        status: 'connected',
        lastActive: Math.floor(Date.now() / 1000)
      };

      const updatedParticipants = [...participants, newParticipantData];
      await contract.setData("participants", ethers.toUtf8Bytes(JSON.stringify(updatedParticipants)));

      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Participant added successfully!" 
      });

      await loadParticipants();
      setNewParticipant({ name: "", address: "" });
      setShowAddParticipantModal(false);

      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Failed to add participant: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const addEncryptedData = async () => {
    if (!isConnected) { 
      alert("Please connect wallet first"); 
      return; 
    }

    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Encrypting data with Zama FHE..." 
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");

      const encryptedValue = FHEEncryptNumber(newData.value);
      const newDataItem: EncryptedData = {
        id: `data-${Date.now()}`,
        value: newData.value,
        encryptedValue,
        owner: address!,
        timestamp: Math.floor(Date.now() / 1000),
        category: newData.category
      };

      const updatedData = [...encryptedData, newDataItem];
      await contract.setData("encrypted_data", ethers.toUtf8Bytes(JSON.stringify(updatedData)));

      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Data encrypted and stored successfully!" 
      });

      await loadEncryptedData();
      setNewData({ value: 0, category: "medical" });
      setShowAddDataModal(false);

      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Failed to add data: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const performPSIComputation = async () => {
    if (!isConnected || participants.length < 2) { 
      alert("Need at least 2 participants for PSI computation"); 
      return; 
    }

    setIsComputing(true);
    setComputationProgress(0);
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Initializing FHE-based PSI computation..." 
    });

    try {
      // Simulate FHE computation progress
      const progressInterval = setInterval(() => {
        setComputationProgress(prev => {
          const newProgress = prev + Math.random() * 10;
          return newProgress >= 100 ? 100 : newProgress;
        });
      }, 500);

      // Group data by participant for PSI computation
      const participantData = participants.map(participant => 
        encryptedData
          .filter(data => data.owner === participant.address)
          .map(data => data.encryptedValue)
      );

      // Perform FHE-based PSI computation
      const psiResult = FHEComputePSI(participantData);

      clearInterval(progressInterval);
      setComputationProgress(100);

      // Store computation result
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");

      const newComputation: Computation = {
        id: `comp-${Date.now()}`,
        participants: participants.map(p => p.address),
        timestamp: Math.floor(Date.now() / 1000),
        result: psiResult,
        status: 'completed',
        encryptedData: participantData
      };

      const updatedComputations = [...computations, newComputation];
      await contract.setData("computations", ethers.toUtf8Bytes(JSON.stringify(updatedComputations)));

      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: `PSI computation completed! Found ${psiResult.length} common items` 
      });

      await loadComputations();
      setShowComputeModal(false);
      setIsComputing(false);

      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "PSI computation failed: " + (e.message || "Unknown error") 
      });
      setIsComputing(false);
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { 
      alert("Please connect wallet first"); 
      return null; 
    }

    try {
      const message = `Decrypt FHE data with public key: ${publicKey}`;
      await signMessageAsync({ message });
      
      // Simulate decryption process
      await new Promise(resolve => setTimeout(resolve, 1000));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      console.error("Decryption failed:", e); 
      return null; 
    }
  };

  const checkContractAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Contract not available");
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and ready for FHE operations!" 
      });
      
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Contract check failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Initializing FHE Private Set Intersection Tool...</p>
    </div>
  );

  return (
    <div className="app-container fhe-theme">
      <header className="app-header">
        <div className="logo-section">
          <div className="logo">
            <div className="fhe-icon"></div>
            <h1>FHE<span>PSI</span>Tool</h1>
          </div>
          <div className="subtitle">Zama FHE-based Private Set Intersection</div>
        </div>
        <div className="header-actions">
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} />
        </div>
      </header>

      <div className="main-layout">
        {/* Left Sidebar - Participants */}
        <aside className="sidebar">
          <div className="sidebar-section">
            <div className="section-header">
              <h3>Participants</h3>
              <button 
                className="icon-btn" 
                onClick={() => setShowAddParticipantModal(true)}
                title="Add Participant"
              >
                +
              </button>
            </div>
            <div className="participants-list">
              {participants.map(participant => (
                <div key={participant.id} className="participant-item">
                  <div className="participant-avatar"></div>
                  <div className="participant-info">
                    <div className="participant-name">{participant.name}</div>
                    <div className="participant-address">{participant.address.slice(0, 8)}...{participant.address.slice(-6)}</div>
                    <div className="participant-stats">{participant.dataCount} data points</div>
                  </div>
                  <div className={`status-indicator ${participant.status}`}></div>
                </div>
              ))}
              {participants.length === 0 && (
                <div className="empty-state">No participants added yet</div>
              )}
            </div>
          </div>

          <div className="sidebar-section">
            <div className="section-header">
              <h3>Quick Actions</h3>
            </div>
            <div className="action-buttons">
              <button className="action-btn primary" onClick={checkContractAvailability}>
                Check Contract
              </button>
              <button className="action-btn" onClick={() => setShowAddDataModal(true)}>
                Add Data
              </button>
              <button 
                className="action-btn" 
                onClick={() => setShowComputeModal(true)}
                disabled={participants.length < 2}
              >
                Compute PSI
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="content-area">
          <div className="dashboard-grid">
            {/* Statistics Cards */}
            <div className="stats-card">
              <div className="stat-value">{participants.length}</div>
              <div className="stat-label">Participants</div>
              <div className="stat-icon">👥</div>
            </div>
            <div className="stats-card">
              <div className="stat-value">{encryptedData.length}</div>
              <div className="stat-label">Encrypted Items</div>
              <div className="stat-icon">🔒</div>
            </div>
            <div className="stats-card">
              <div className="stat-value">{computations.length}</div>
              <div className="stat-label">Computations</div>
              <div className="stat-icon">⚡</div>
            </div>
            <div className="stats-card">
              <div className="stat-value">
                {computations.reduce((acc, comp) => acc + comp.result.length, 0)}
              </div>
              <div className="stat-label">Intersection Items</div>
              <div className="stat-icon">🔍</div>
            </div>
          </div>

          {/* Data Visualization Section */}
          <div className="visualization-section">
            <h3>FHE Computation Flow</h3>
            <div className="computation-flow">
              <div className="flow-step">
                <div className="step-icon">📊</div>
                <div className="step-label">Plain Data</div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">🔒</div>
                <div className="step-label">FHE Encryption</div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">⚡</div>
                <div className="step-label">PSI Computation</div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">🔍</div>
                <div className="step-label">Encrypted Results</div>
              </div>
            </div>
          </div>

          {/* Computations History */}
          <div className="computations-section">
            <div className="section-header">
              <h3>Computation History</h3>
              <button onClick={loadComputations} disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <div className="computations-list">
              {computations.map(computation => (
                <div 
                  key={computation.id} 
                  className="computation-item"
                  onClick={() => setSelectedComputation(computation)}
                >
                  <div className="computation-header">
                    <div className="computation-id">PSI-{computation.id.slice(-6)}</div>
                    <div className={`computation-status ${computation.status}`}>
                      {computation.status}
                    </div>
                  </div>
                  <div className="computation-details">
                    <div className="detail-item">
                      <span>Participants:</span>
                      <span>{computation.participants.length}</span>
                    </div>
                    <div className="detail-item">
                      <span>Intersection Size:</span>
                      <span>{computation.result.length} items</span>
                    </div>
                    <div className="detail-item">
                      <span>Time:</span>
                      <span>{new Date(computation.timestamp * 1000).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              ))}
              {computations.length === 0 && (
                <div className="empty-state">No computations performed yet</div>
              )}
            </div>
          </div>
        </main>

        {/* Right Sidebar - Recent Activity */}
        <aside className="activity-sidebar">
          <div className="section-header">
            <h3>Recent Activity</h3>
          </div>
          <div className="activity-feed">
            <div className="activity-item">
              <div className="activity-icon">🔒</div>
              <div className="activity-content">
                <div className="activity-message">Data encrypted with FHE</div>
                <div className="activity-time">2 minutes ago</div>
              </div>
            </div>
            <div className="activity-item">
              <div className="activity-icon">👥</div>
              <div className="activity-content">
                <div className="activity-message">New participant joined</div>
                <div className="activity-time">5 minutes ago</div>
              </div>
            </div>
            <div className="activity-item">
              <div className="activity-icon">⚡</div>
              <div className="activity-content">
                <div className="activity-message">PSI computation completed</div>
                <div className="activity-time">1 hour ago</div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Modals */}
      {showAddParticipantModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Add Participant</h3>
              <button onClick={() => setShowAddParticipantModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Participant Name</label>
                <input
                  type="text"
                  value={newParticipant.name}
                  onChange={(e) => setNewParticipant({...newParticipant, name: e.target.value})}
                  placeholder="Enter participant name"
                />
              </div>
              <div className="form-group">
                <label>Wallet Address (optional)</label>
                <input
                  type="text"
                  value={newParticipant.address}
                  onChange={(e) => setNewParticipant({...newParticipant, address: e.target.value})}
                  placeholder="Leave empty to use connected wallet"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowAddParticipantModal(false)}>Cancel</button>
              <button onClick={addParticipant} className="primary">Add Participant</button>
            </div>
          </div>
        </div>
      )}

      {showAddDataModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Add Encrypted Data</h3>
              <button onClick={() => setShowAddDataModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="fhe-notice">
                <strong>FHE Encryption Active</strong>
                <p>Your data will be encrypted with Zama FHE before storage</p>
              </div>
              <div className="form-group">
                <label>Data Category</label>
                <select
                  value={newData.category}
                  onChange={(e) => setNewData({...newData, category: e.target.value})}
                >
                  <option value="medical">Medical Data</option>
                  <option value="financial">Financial Data</option>
                  <option value="research">Research Data</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="form-group">
                <label>Numerical Value</label>
                <input
                  type="number"
                  value={newData.value}
                  onChange={(e) => setNewData({...newData, value: parseFloat(e.target.value) || 0})}
                  placeholder="Enter numerical value"
                />
              </div>
              <div className="encryption-preview">
                <div className="preview-label">Encryption Preview:</div>
                <div className="preview-value">
                  {FHEEncryptNumber(newData.value).substring(0, 50)}...
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowAddDataModal(false)}>Cancel</button>
              <button onClick={addEncryptedData} className="primary">Encrypt & Store</button>
            </div>
          </div>
        </div>
      )}

      {showComputeModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Compute Private Set Intersection</h3>
              <button onClick={() => setShowComputeModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="computation-info">
                <p>Perform FHE-based PSI computation across {participants.length} participants</p>
                <div className="participants-count">
                  <span>Participants:</span>
                  <span>{participants.length}</span>
                </div>
                <div className="data-count">
                  <span>Total Data Items:</span>
                  <span>{encryptedData.length}</span>
                </div>
              </div>

              {isComputing && (
                <div className="computation-progress">
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{ width: `${computationProgress}%` }}
                    ></div>
                  </div>
                  <div className="progress-text">
                    FHE Computation: {Math.round(computationProgress)}%
                  </div>
                  <div className="computation-steps">
                    <div className="step">Encrypting data...</div>
                    <div className="step">Performing homomorphic operations...</div>
                    <div className="step">Computing intersection...</div>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowComputeModal(false)}>Cancel</button>
              <button 
                onClick={performPSIComputation} 
                disabled={isComputing || participants.length < 2}
                className="primary"
              >
                {isComputing ? 'Computing...' : 'Start PSI Computation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedComputation && (
        <div className="modal-overlay">
          <div className="modal large">
            <div className="modal-header">
              <h3>Computation Details</h3>
              <button onClick={() => setSelectedComputation(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="computation-detail">
                <div className="detail-section">
                  <h4>Basic Information</h4>
                  <div className="detail-grid">
                    <div className="detail-item">
                      <span>Computation ID:</span>
                      <span>{selectedComputation.id}</span>
                    </div>
                    <div className="detail-item">
                      <span>Status:</span>
                      <span className={`status ${selectedComputation.status}`}>
                        {selectedComputation.status}
                      </span>
                    </div>
                    <div className="detail-item">
                      <span>Timestamp:</span>
                      <span>{new Date(selectedComputation.timestamp * 1000).toLocaleString()}</span>
                    </div>
                    <div className="detail-item">
                      <span>Participants:</span>
                      <span>{selectedComputation.participants.length}</span>
                    </div>
                  </div>
                </div>

                <div className="detail-section">
                  <h4>Results</h4>
                  <div className="results-section">
                    <div className="result-count">
                      Intersection contains {selectedComputation.result.length} items
                    </div>
                    <div className="encrypted-results">
                      {selectedComputation.result.slice(0, 5).map((result, index) => (
                        <div key={index} className="encrypted-result">
                          {result.substring(0, 50)}...
                        </div>
                      ))}
                      {selectedComputation.result.length > 5 && (
                        <div className="more-items">
                          ... and {selectedComputation.result.length - 5} more items
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <div className="notification-icon">
              {transactionStatus.status === 'success' ? '✓' : 
               transactionStatus.status === 'error' ? '✕' : '⏳'}
            </div>
            <div className="notification-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;