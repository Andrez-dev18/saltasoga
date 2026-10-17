<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class JumpSession extends Model
{
    use HasFactory;

    //columnas que se permiten llenar desde formularios o request
    protected $fillable = [
        'user_id',
        'duration_seconds',
        'total_jumps',
        'avg_spm',
        'calories',
        'completed_at',
    ];

    //relacion inversa: cada sesion pertenece a un usuario
    //equivale a manytoOne en JPA
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
