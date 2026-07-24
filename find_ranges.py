with open('app.js', encoding='utf-8') as f:
    lines = f.readlines()

def find_func(name):
    start = -1
    for i, line in enumerate(lines):
        if name in line:
            start = i + 1
            break
    if start == -1:
        return "Not found"
    
    # find closing brace
    braces = 0
    end = -1
    started = False
    for i in range(start - 1, len(lines)):
        line = lines[i]
        braces += line.count('{')
        braces -= line.count('}')
        if '{' in line:
            started = True
        if started and braces <= 0:
            end = i + 1
            break
    return f"{start} to {end}"

print("openReplicationReviewModal:", find_func("function openReplicationReviewModal"))
print("updatePendingBookingLeg:", find_func("function updatePendingBookingLeg"))
print("updatePendingBookingTime:", find_func("function updatePendingBookingTime"))
print("commitPendingBookings:", find_func("function commitPendingBookings"))
