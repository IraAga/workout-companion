import './styles.css';
import { createStore } from './core/store';
import { mountApp } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('#app is missing from index.html');

mountApp(root, createStore());
