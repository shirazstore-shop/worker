export function formatDateForDisplay(timestamp) {
  if (!timestamp) return '-';
  // Handle both seconds and ISO string
  const date = typeof timestamp === 'number' 
    ? new Date(timestamp * 1000)  // Convert seconds to ms
    : new Date(timestamp);         // ISO string
  
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
