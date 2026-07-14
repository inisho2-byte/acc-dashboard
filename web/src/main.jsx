import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import LoadingScreen from './components/LoadingScreen';
import './styles/animations.css';
import './styles/contrast.css';

function Root() {
  const [loading, setLoading] = React.useState(true);
  if (loading) {
    return <LoadingScreen onComplete={() => setLoading(false)} />;
  }
  return (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
