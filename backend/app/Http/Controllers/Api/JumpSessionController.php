<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\JumpSession;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class JumpSessionController extends Controller
{
    /**
     * Devuelve el historial de sesiones de salto del usuario autenticado.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'from' => 'nullable|date_format:Y-m-d',
            'to' => 'nullable|date_format:Y-m-d|after_or_equal:from',
        ]);

        $from = $request->filled('from')
            ? Carbon::parse($request->query('from'))->startOfDay()
            : Carbon::now()->subDays(7)->startOfDay();

        $to = $request->filled('to')
            ? Carbon::parse($request->query('to'))->endOfDay()
            : Carbon::now()->endOfDay();

        $sessions = $request->user()
            ->jumpSessions()
            ->whereBetween('completed_at', [$from, $to])
            ->latest('completed_at')
            ->get();

        return response()->json([
            'status' => 'success',
            'range' => [
                'from' => $from->toDateString(),
                'to' => $to->toDateString(),
            ],
            'data' => $sessions,
        ], 200);
    }

    /**
     * Registra una nueva sesión de salto asociada al usuario autenticado.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'duration_seconds' => 'required|integer|min:1',
            'total_jumps' => 'required|integer|min:0',
            'avg_spm' => 'nullable|integer|min:0',
            'calories' => 'nullable|numeric|min:0',
            'completed_at' => 'nullable|date',
        ]);

        $validated['completed_at'] = $validated['completed_at'] ?? now();

        $session = $request->user()->jumpSessions()->create($validated);

        return response()->json([
            'status' => 'success',
            'message' => 'Sesión registrada correctamente',
            'data' => $session,
        ], 201);
    }

    /**
     * Muestra el detalle de una sesión si pertenece al usuario autenticado.
     */
    public function show(Request $request, JumpSession $session): JsonResponse
    {
        if ($session->user_id !== $request->user()->id) {
            return response()->json([
                'status' => 'error',
                'message' => 'No autorizado para ver esta sesión.',
            ], 403);
        }

        return response()->json([
            'status' => 'success',
            'data' => $session,
        ], 200);
    }

    /**
     * Elimina una sesión si pertenece al usuario autenticado.
     */
    public function destroy(Request $request, JumpSession $session): JsonResponse
    {
        if ($session->user_id !== $request->user()->id) {
            return response()->json([
                'status' => 'error',
                'message' => 'No autorizado para eliminar esta sesión.',
            ], 403);
        }

        $session->delete();

        return response()->json([
            'status' => 'success',
            'message' => 'Sesión eliminada correctamente',
        ], 200);
    }

    /**
     * Devuelve métricas acumuladas y récords personales del usuario autenticado.
     */
    public function stats(Request $request): JsonResponse
    {
        $query = $request->user()->jumpSessions();

        $summary = (clone $query)->selectRaw('
            COUNT(*) as total_sessions,
            COALESCE(SUM(total_jumps), 0) as total_jumps,
            COALESCE(SUM(duration_seconds), 0) as total_duration_seconds,
            COALESCE(SUM(calories), 0) as total_calories,
            COALESCE(AVG(avg_spm), 0) as avg_spm,
            COALESCE(MAX(total_jumps), 0) as best_session_jumps,
            COALESCE(MAX(avg_spm), 0) as best_spm,
            COALESCE(MAX(duration_seconds), 0) as best_duration_seconds
        ')->first();

        $weekSummary = (clone $query)
            ->where('completed_at', '>=', Carbon::now()->subDays(7)->startOfDay())
            ->selectRaw('
                COUNT(*) as sessions,
                COALESCE(SUM(total_jumps), 0) as total_jumps,
                COALESCE(SUM(duration_seconds), 0) as total_duration_seconds,
                COALESCE(SUM(calories), 0) as total_calories
            ')->first();

        return response()->json([
            'status' => 'success',
            'data' => [
                'total_sessions' => (int) $summary->total_sessions,
                'total_jumps' => (int) $summary->total_jumps,
                'total_duration_seconds' => (int) $summary->total_duration_seconds,
                'total_calories' => round((float) $summary->total_calories, 2),
                'avg_spm' => (int) round((float) $summary->avg_spm),
                'best_session_jumps' => (int) $summary->best_session_jumps,
                'best_spm' => (int) $summary->best_spm,
                'best_duration_seconds' => (int) $summary->best_duration_seconds,
                'last_7_days' => [
                    'sessions' => (int) $weekSummary->sessions,
                    'total_jumps' => (int) $weekSummary->total_jumps,
                    'total_duration_seconds' => (int) $weekSummary->total_duration_seconds,
                    'total_calories' => round((float) $weekSummary->total_calories, 2),
                ],
            ],
        ], 200);
    }
}
