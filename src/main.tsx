import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installAudioUnlock } from './lib/alertSound';

installAudioUnlock();

createRoot(document.getElementById('root')!).render(<App />);
