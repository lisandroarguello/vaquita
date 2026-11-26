import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'

const clienteDeQuery = new QueryClient({
  defaultOptions: {
    queries: {
      // Un 401 no se reintenta: el token no va a mejorar solo, y reintentar
      // retrasa la ida al login. El resto sí, una vez, por si fue la red.
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

const raiz = document.getElementById('raiz')
if (raiz === null) throw new Error('Falta #raiz en index.html')

createRoot(raiz).render(
  <StrictMode>
    <QueryClientProvider client={clienteDeQuery}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
)
