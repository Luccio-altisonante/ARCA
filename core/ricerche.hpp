#ifndef ANAGRAMMI_RICERCHE_HPP
#define ANAGRAMMI_RICERCHE_HPP

#include "vocabolario.hpp"

#include <cstddef>
#include <cstdint>
#include <string>

namespace anagrammi {

// Budget di risorse per ^: l'estrazione resta con reinserimento, senza troncamenti.
inline constexpr std::uint32_t massimo_estrazioni_casuali = 100000;

Words cerca_anagrammi(const Words& vocabulary, const std::string& searched, std::size_t wanted_length);
Words sostituisci_punti_interrogativi(const Words& vocabulary, const std::string& pattern);
Words cerca_con_jolly(const Words& vocabulary, const std::string& pattern);
Words parole_con_tutte_le_lettere(const Words& vocabulary, std::string searched);
Words parole_senza_lettere(const Words& vocabulary, std::string searched);
Words parole_formabili_da_lettere(const Words& vocabulary, std::string searched);
Words parole_casuali(const Words& vocabulary, const std::string& command, std::string& footer);
Words password_casuali(const std::string& command, std::string& footer);

} // namespace anagrammi

#endif
