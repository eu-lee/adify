import { Routes, Route, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import ConnectStore from './pages/ConnectStore.jsx'
import ProductLibrary from './pages/ProductLibrary.jsx'

function App() {
  const location = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a' }}>
      <Routes>
        <Route path="/" element={<ConnectStore />} />
        <Route path="/products" element={<ProductLibrary />} />
      </Routes>
    </div>
  )
}

export default App
