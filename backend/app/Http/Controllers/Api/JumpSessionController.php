<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Carbon\Carbon;
use Illuminate\Http\Request;
use App\Models\JumpSession;

class JumpSessionController extends Controller
{
    /**
     * devuelve el historial de sessiones de salto
     */
    public function index(Request $request)
    {
        // 1. Validar fechas opcionales
        $request->validate([
            'from' => 'nullable|date_format:Y-m-d',
            'to'   => 'nullable|date_format:Y-m-d|after_or_equal:from',
        ]);

        // 2. Si no se envían, por defecto toma los últimos 7 días
        $from = $request->filled('from')
            ? Carbon::parse($request->query('from'))->startOfDay()
            : Carbon::now()->subDays(7)->startOfDay();

        $to = $request->filled('to')
            ? Carbon::parse($request->query('to'))->endOfDay()
            : Carbon::now()->endOfDay();

        // 3. Consultar las sesiones en ese rango
        $sessions = JumpSession::whereBetween('completed_at', [$from, $to])
            ->latest('completed_at')
            ->get();

        return response()->json([
            'status' => 'success',
            'range'  => [
                'from' => $from->toDateString(),
                'to'   => $to->toDateString(),
            ],
            'data'   => $sessions
        ], 200);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        // 1. Validación de datos de entrada
        $validated = $request->validate([
            'duration_seconds' => 'required|integer|min:1',
            'total_jumps'      => 'required|integer|min:0',
            'avg_spm'          => 'nullable|integer|min:0',
            'calories'         => 'nullable|numeric|min:0',
            'user_id'          => 'nullable|exists:users,id',
        ]);

        // Por ahora, si no hay autenticación, usamos el usuario 1 por defecto (o puedes crearlo)
        $validated['user_id'] = $validated['user_id'] ?? 1;

        // 2. Creación en base de datos con Eloquent
        $session = JumpSession::create($validated);

        // 3. Respuesta JSON con código HTTP 201 (Created)
        return response()->json([
            'status'  => 'success',
            'message' => 'Sesión registrada correctamente',
            'data'    => $session
        ], 201);
    }

    /**
     * Display the specified resource.
     */
    public function show(string $id)
    {
        //
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, string $id)
    {
        //
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(string $id)
    {
        //
    }
}
