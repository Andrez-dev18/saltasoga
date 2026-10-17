<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('jump_sessions', function (Blueprint $table) {
            $table->id(); //id autoincrementable

            //clave foranea que relaciona al usuario
            $table->foreignId('user_id')->constrained('users')->onDelete('cascade');

            $table->unsignedInteger('duration_seconds'); //duracion de saltos
            $table->unsignedInteger('total_jumps'); //total de saltos
            $table->unsignedSmallInteger('avg_spm')->default(0); //promedio de saltos por minuto
            $table->decimal('calories', 6,2)->nullable(); //estimacion de calorias quemadas opcional
            $table->timestamp('completed_at')->useCurrent(); // fecha y hora de saltos

            $table->timestamps(); //tiempo y fecha de creacion del registro
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('jump_sessions');
    }
};
