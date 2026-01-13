// components/admin/StatCard.jsx
export default function StatCard({ title, value, icon, loading, error }) {
  return (
    <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-xl p-4 md:p-5 relative overflow-hidden group hover:border-slate-600 transition-all duration-300">
      <div className="absolute top-0 right-0 w-16 h-16 bg-red-900/10 rounded-bl-full transform translate-x-4 -translate-y-4 group-hover:bg-red-900/20 transition-colors duration-300" />

      <div className="flex justify-between items-start mb-4">
        <div className="text-sm text-slate-400 font-medium">{title}</div>
        <div className="text-lg p-1 bg-slate-700/50 rounded-md">{icon}</div>
      </div>

      <div className="mt-2 text-2xl md:text-3xl font-semibold text-slate-100">
        {loading ? (
          <div className="h-8 bg-slate-700/50 rounded-md animate-pulse"></div>
        ) : error ? (
          <span className="text-slate-500">—</span>
        ) : (
          value
        )}
      </div>

      <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-red-600 to-red-800 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
    </div>
  );
}
