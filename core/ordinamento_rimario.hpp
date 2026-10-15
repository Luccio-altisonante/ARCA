#ifndef ANAGRAMMI_ORDINAMENTO_RIMARIO_HPP
#define ANAGRAMMI_ORDINAMENTO_RIMARIO_HPP

#include "vocabolario.hpp"

#include <string>

namespace anagrammi {

std::string chiave_rimario(const std::string& parola);
bool rimario_less(const std::string& sinistra, const std::string& destra);
void ordina_rimario(Words& parole);
bool e_ordinato_rimario(const Words& parole);

} // namespace anagrammi

#endif
