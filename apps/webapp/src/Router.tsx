import { BrowserRouter, Route, Routes } from 'react-router'
import { RootLayout } from './layout/RootLayout'
import { DedupPage } from './pages/Dedup'
import { FilesPage } from './pages/Files'
import { FilterPage } from './pages/Filter'
import { HistoryPage } from './pages/History'
import { HomePage } from './pages/Home'
import { ImportPage } from './pages/Import'
import { LinksPage } from './pages/Links'

export function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootLayout />}>
          <Route index element={<HomePage />} />
          <Route path="/links" element={<LinksPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/dedup" element={<DedupPage />} />
          <Route path="/filter" element={<FilterPage />} />
          <Route path="/history" element={<HistoryPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
