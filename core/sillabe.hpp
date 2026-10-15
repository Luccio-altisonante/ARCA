#ifndef ANAGRAMMI_SILLABE_HPP
#define ANAGRAMMI_SILLABE_HPP

#include <cstddef>
#include <string_view>

namespace anagrammi {

// Conteggio ortografico/euristico italiano, non un sillabatore.
// Grafie ambigue o accenti non scritti possono dare una stima inesatta.
// Input vuoto, senza vocali o con spazi interni: 0. Altri caratteri non
// vocalici interrompono i gruppi; UTF-8 invalido segue gli helper Unicode.
// Indipendente dal rimario: le regole possono evolvere senza modificarlo.
std::size_t conta_sillabe(std::string_view parola);

} // namespace anagrammi

#endif
